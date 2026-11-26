/* client-pick.js — A407 · "Which client is this for?" The client named from the rep's own Client Book.
 *
 * Neil, 25 Nov 2026: "New purchase requests and quotations must pick the client from the rep's book; a new client can
 * be added there in place." One picker for the two pages that make one: the purchase request form
 * (flow-pricing-request.html) and the quote builder (flow-quotations.html, js/flow-quote-configurator.js).
 *
 *   cpLoadBook()                         → { ok, clients, lists } — ok false before FlowAPI 204 or on any failure
 *   cpMount(root, { inputId, required, clients, lists, label, hint, what, onPick, submitId, whyId }) → picker
 *     picker.value() · client() · pick(c | clientNo) · clear() · check() · showError(text, require) · setMode({...})
 *     picker.search(text) · suggest(name) · saveNew(fields) · openAdd(name) · error() · isRequired()
 *
 * A search box over the rep's live clients (any of a client's spellings, its plant or head office, its industry); the
 * chosen client as a card with Change; and Add a client as a sheet — the company, Major / Minor / Developing as a
 * segmented control, the industry (Others typed), an optional plant address — that saves to the book
 * (saveClientBookClient) and chooses the new client. A twin (the server's `duplicate`) offers the client already there.
 * The Client No is kept in a hidden input (inputId), so a form reads it the way it read the A358 select.
 *
 * The apple-design skill on the --hx tokens (css/client-pick.css): feedback on press, the list anchored to the search
 * box, a sheet that rises from the bottom on a phone with a grabber (drag it down to close) and leaves the same way,
 * focus into the sheet and back to where it came from, a cross-fade under reduced motion; labels in sentence case and
 * errors that say what to do. The pure part and the picker are tested in tests/flow/client-pick.js.
 */

const CP_TIERS = ['Major', 'Minor', 'Developing'];
const CP_SECTORS = ['Oil and gas', 'Cement', 'Power', 'Aviation', 'Automotive', 'Construction', 'Mining', 'Others'];
const CP_MISSING = 'Choose the client from your Client Book, or add it there.';
const CP_SHOWN = 60;          // rows listed at once; typing narrows the rest
let _cpSeq = 0;

function _cpE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : hxEsc(s); }   // the one escape (js/flow-api.js, js/api.js)
function _cpPost(o) { return (o && o.post) || (typeof postFlow === 'function' ? postFlow : null); }
function _cpAttr(el, k, v) {
  if (!el) return;
  if (v === null || v === undefined) { if (el.removeAttribute) el.removeAttribute(k); }
  else if (el.setAttribute) el.setAttribute(k, String(v));
}
function _cpClass(el, cls, on) { if (el && el.classList && el.classList.toggle) el.classList.toggle(cls, !!on); }

/* ── the pure part ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** A name as the search compares it: lower case, "&" as "and", punctuation gone. */
function cpKey(s) { return String(s == null ? '' : s).toLowerCase().split('&').join(' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }

/** The clients a picker offers: live (not archived), named, A to Z. */
function cpLive(clients) {
  return (clients || []).filter(c => c && c.clientNo && String(c.company || '').trim() && !c.archivedAt)
    .sort((a, b) => String(a.company).localeCompare(String(b.company)));
}

/** Every word typed must be in the client's name, another spelling, its plant or head office, or its industry. A name
 *  that starts with the text comes first, then one with a word that does, then the rest; A to Z within each. */
function cpSearch(clients, q, limit) {
  const list = cpLive(clients), key = cpKey(q), words = key.split(' ').filter(Boolean);
  if (!words.length) return limit ? list.slice(0, limit) : list;
  const scored = [];
  list.forEach(c => {
    const names = [c.company].concat(c.names || []).map(cpKey);
    const hay = names.concat([cpKey(c.siteAddress), cpKey(c.headOfficeAddress), cpKey(c.sector)]).join(' | ');
    if (!words.every(w => hay.indexOf(w) >= 0)) return;
    const s = names.some(n => n.indexOf(key) === 0) ? 0 : names.some(n => (' ' + n).indexOf(' ' + key) >= 0) ? 1
      : names.some(n => words.every(w => n.indexOf(w) >= 0)) ? 2 : 3;
    scored.push({ c, s });
  });
  scored.sort((a, b) => a.s - b.s || String(a.c.company).localeCompare(String(b.c.company)));
  const out = scored.map(x => x.c);
  return limit ? out.slice(0, limit) : out;
}

/** The one client a name means — its company or one of its other spellings, said the same way — or null. */
function cpExact(clients, name) {
  const k = cpKey(name);
  if (!k) return null;
  const hits = cpLive(clients).filter(c => [c.company].concat(c.names || []).some(n => cpKey(n) === k));
  return hits.length === 1 ? hits[0] : null;
}

/** A sales rep must name the client (FlowSettings requireClientPick, on unless 'off'); every other role may. */
function cpRequired(role, settings) {
  const s = settings || {}, v = s.requireClientPick == null ? 'on' : s.requireClientPick;
  return String(role || '').trim().toLowerCase() === 'sales' && String(v).trim().toLowerCase() !== 'off';
}

/** The labels and industries the server sent (getClientBook lists), or this file's copy. */
function cpTiers(lists) { return (lists && Array.isArray(lists.tiers) && lists.tiers.length ? lists.tiers : CP_TIERS).slice(); }
function cpSectors(lists) { return (lists && Array.isArray(lists.sectors) && lists.sectors.length ? lists.sectors : CP_SECTORS).slice(); }
function _cpOr(list) { return list.length > 1 ? list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1] : (list[0] || ''); }

/** What Add a client sends: { payload } — or { error, field } saying what is missing, in the order the sheet asks. */
function cpNewPayload(f, tiers) {
  f = f || {};
  const t = tiers && tiers.length ? tiers : CP_TIERS;
  const company = String(f.company || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const tier = String(f.tier || '').trim();
  const pick = String(f.sector || '').trim(), other = String(f.sectorOther || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const sector = pick === 'Others' ? other : pick;
  if (!company) return { error: 'Type the company name.', field: 'company' };
  if (t.indexOf(tier) < 0) return { error: 'Choose ' + _cpOr(t) + '.', field: 'tier' };
  if (!pick) return { error: 'Choose the industry.', field: 'sector' };
  if (!sector) return { error: 'Type the industry you meant by Others.', field: 'sectorOther' };
  const payload = { company, tier, sector, contactsJson: '[]', notes: '', nextStep: '', nextStepDate: '' };
  const site = String(f.siteAddress || '').trim().slice(0, 300);
  if (site) payload.siteAddress = site;
  return { payload };
}

/** Read the rep's book for a picker. Before FlowAPI 204, or when it cannot be read, { ok: false }: the page keeps the
 *  form it had and says nothing. */
async function cpLoadBook(o) {
  const post = _cpPost(o);
  if (!post) return { ok: false };
  try {
    if (typeof flowVersionAtLeast === 'function' && !(await flowVersionAtLeast(204))) return { ok: false, old: true };
    const r = await post('getClientBook', {});
    if (!r || !r.success) return { ok: false };
    return { ok: true, clients: cpLive(r.clients), lists: r.lists || {} };
  } catch (e) { return { ok: false }; }
}

/** Add a client to the rep's book: { ok, client } · { duplicate, existing, fresh, message } · { error }. A twin the
 *  loaded list does not hold is looked up in a fresh read of the book, so it can still be offered. */
async function cpAddClient(f, o) {
  o = o || {};
  const v = cpNewPayload(f, o.tiers);
  if (v.error) return v;
  const post = _cpPost(o);
  if (!post) return { error: 'The client cannot be added from this page. Add it in the Client Book.' };
  let r;
  try { r = await post('saveClientBookClient', v.payload); }
  catch (e) { return { error: 'The client was not added (' + ((e && e.message) || 'no answer') + '). Try again.' }; }
  if (r && r.success && r.clientNo) {
    return { ok: true, client: Object.assign({ company: v.payload.company, tier: v.payload.tier, sector: v.payload.sector,
      siteAddress: v.payload.siteAddress || '', headOfficeAddress: '', contacts: [], names: [], archivedAt: '' }, r.client || {}, { clientNo: String(r.clientNo) }) };
  }
  if (r && r.duplicate) {
    const no = String(r.duplicate);
    let existing = cpLive(o.clients).find(c => String(c.clientNo) === no) || null, fresh = null;
    if (!existing) {
      try {
        const b = await post('getClientBook', {});
        if (b && b.success) { fresh = cpLive(b.clients); existing = fresh.find(c => String(c.clientNo) === no) || null; }
      } catch (e) { /* the message still says where it is */ }
    }
    return { duplicate: no, existing, fresh, message: r.message || 'That client is already in your Client Book.' };
  }
  return { error: (r && r.message) || 'The client was not added. Try again.' };
}

/* ── the HTML (pure, so the tests read it) ─────────────────────────────────────────────────────────────────────── */

function cpTierHtml(t) { return t ? '<span class="cp-tier" data-tier="' + _cpE(cpKey(t)) + '">' + _cpE(t) + '</span>' : ''; }
function cpWhere(c) { return [c.siteAddress || c.headOfficeAddress, c.sector].filter(Boolean).join(' · '); }
function cpOptionHtml(c, id, on) {
  const where = cpWhere(c);
  return '<li class="cp-opt" role="option" id="' + id + '" data-cp-pick="' + _cpE(c.clientNo) + '" aria-selected="' + (on ? 'true' : 'false') + '">' +
    '<span class="cp-ol"><span class="cp-on">' + _cpE(c.company) + '</span>' + cpTierHtml(c.tier) + '</span>' +
    (where ? '<span class="cp-os">' + _cpE(where) + '</span>' : '') + '</li>';
}
/** The open list: the matches (A to Z when nothing is typed), then Add a client — with what was typed. */
function cpListHtml(st, uid) {
  const q = String(st.q || '').trim(), hits = st.hits || [];
  let h = hits.map((c, i) => cpOptionHtml(c, uid + 'o' + i, i === st.active)).join('');
  if (!hits.length) h += '<li class="cp-none" role="presentation">' + ((st.clients || []).length ? 'No client in your book matches “' + _cpE(q) + '”.' : 'Your Client Book has no clients yet.') + '</li>';
  else if (st.more) h += '<li class="cp-none" role="presentation">' + st.more + ' more. Type to narrow the list.</li>';
  return h + '<li class="cp-opt cp-add" role="option" id="' + uid + 'oadd" data-cp-add aria-selected="' + (st.active === hits.length ? 'true' : 'false') + '">' +
    '<span class="cp-plus" aria-hidden="true">+</span><span class="cp-on">' + (q ? 'Add “' + _cpE(q) + '” as a new client' : 'Add a client') + '</span></li>';
}
function cpChosenHtml(c) {
  const where = cpWhere(c);
  return '<span class="cp-ct"><span class="cp-ol"><span class="cp-on">' + _cpE(c.company) + '</span>' + cpTierHtml(c.tier) + '</span>' +
    (where ? '<span class="cp-os">' + _cpE(where) + '</span>' : '') + '</span>' +
    '<button type="button" class="cp-change" data-cp="change">Change<span class="cp-sr"> the client</span></button>';
}
function cpSheetHtml(o) {
  const uid = o.uid, tiers = cpTiers(o.lists), sectors = cpSectors(o.lists);
  return '<div class="cp-sheet" role="dialog" aria-modal="true" aria-labelledby="' + uid + 't" aria-describedby="' + uid + 'l">' +
    '<div class="cp-grab" data-cp-grab aria-hidden="true"><span></span></div>' +
    '<header class="cp-head"><h2 id="' + uid + 't">Add a client</h2>' +
      '<p class="cp-lede" id="' + uid + 'l">It goes into your Client Book, and this ' + _cpE(o.what || 'record') + ' is put on it.</p></header>' +
    '<div class="cp-body">' +
      '<label class="cp-field"><span class="cp-cap">Company name</span>' +
        '<input type="text" class="hx-field cp-in" name="company" maxlength="160" autocomplete="off" value="' + _cpE(o.company || '') + '"></label>' +
      '<fieldset class="cp-field"><legend class="cp-cap">Label</legend><div class="cp-seg" role="radiogroup" aria-label="Label">' +
        tiers.map(t => '<label class="cp-seg-o"><input type="radio" name="' + uid + 'tier" value="' + _cpE(t) + '"><span>' + _cpE(t) + '</span></label>').join('') + '</div></fieldset>' +
      '<label class="cp-field"><span class="cp-cap">Industry</span><select class="hx-field cp-in" name="sector"><option value="">Choose…</option>' +
        sectors.map(s => '<option>' + _cpE(s) + '</option>').join('') + '</select></label>' +
      '<label class="cp-field" data-cp-other hidden><span class="cp-cap">Which industry?</span>' +
        '<input type="text" class="hx-field cp-in" name="sectorOther" maxlength="60" placeholder="Shipbuilding" autocomplete="off"></label>' +
      '<label class="cp-field"><span class="cp-cap">Plant address <span class="cp-opt-w">Optional</span></span>' +
        '<textarea class="hx-field cp-in" name="siteAddress" rows="2" maxlength="300" placeholder="Plant or site, city, province"></textarea></label>' +
      '<div class="cp-note" data-cp-note role="alert" hidden></div>' +
    '</div>' +
    '<footer class="cp-foot"><span class="cp-why" data-cp-why aria-live="polite"></span>' +
      '<button type="button" class="btn btn-secondary" data-cp="cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary primary" data-cp="save" disabled>Add client</button></footer></div>';
}
/** The twin the server found: say so, and offer it. */
function cpDuplicateHtml(res) {
  const c = res && res.existing;
  return '<p>' + _cpE((res && res.message) || 'That client is already in your Client Book.') + '</p>' +
    (c ? '<button type="button" class="btn btn-primary primary cp-use" data-cp="use">Use ' + _cpE(c.company) + '</button>'
       : '<p class="cp-os">Close this and search your book for it.</p>');
}

/* ── the picker ────────────────────────────────────────────────────────────────────────────────────────────────── */

function cpMount(root, o) {
  if (!root || typeof document === 'undefined') return null;
  o = o || {};
  const uid = 'cp' + (++_cpSeq);
  const st = { clients: cpLive(o.clients), lists: o.lists || {}, chosen: null, required: !!o.required, hidden: false,
               label: o.label || 'Client', hint: o.hint || '', q: '', open: false, active: -1, hits: [], more: 0, touched: false, error: '', adding: false };
  if (root.classList) root.classList.add('cp-row');
  root.innerHTML =
    '<label class="cp-label" for="' + uid + 'q"><span data-cp="label"></span> <span class="cp-mark" data-cp="mark"></span></label>' +
    (o.inputId ? '<input type="hidden" id="' + _cpE(o.inputId) + '" value="">' : '') +
    '<div class="cp-box">' +
      '<input type="text" class="hx-field cp-q" id="' + uid + 'q" data-cp="q" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + uid + 'l"' +
        ' aria-describedby="' + uid + 'm" autocomplete="off" spellcheck="false" placeholder="Search your Client Book">' +
      '<ul class="cp-list" id="' + uid + 'l" data-cp="list" role="listbox" aria-label="Your clients" hidden></ul>' +
      '<div class="cp-chosen" data-cp="chosen" hidden></div>' +
    '</div>' +
    '<div class="cp-line"><p class="cp-msg" id="' + uid + 'm" data-cp="msg" aria-live="polite"></p>' +
      '<button type="button" class="cp-addlink" data-cp="add">Add a client</button></div>';
  const part = (k) => root.querySelector('[data-cp="' + k + '"]');
  const q = part('q'), list = part('list'), chosen = part('chosen'), msg = part('msg'), lab = part('label'), mark = part('mark'), addLink = part('add');
  if (!q || !list || !chosen || !msg || !lab || !mark || !addLink) return null;   // a host that cannot hold it: the page keeps its own form
  const hid = (o.inputId && document.getElementById(o.inputId)) || root.querySelector('input[type="hidden"]');
  const why = o.whyId ? document.getElementById(o.whyId) : null, submit = o.submitId ? document.getElementById(o.submitId) : null;

  function paint() {
    const c = st.chosen, need = st.required && !c && !st.hidden, bad = !!st.error && !st.hidden;
    root.hidden = st.hidden;
    lab.textContent = st.label;
    mark.textContent = st.required ? '*' : 'Optional';
    _cpClass(mark, 'cp-optional', !st.required);
    q.hidden = !!c; chosen.hidden = !c; addLink.hidden = !!c;
    const drawn = c ? String(c.clientNo) : '';
    if (st.drawn !== drawn) { chosen.innerHTML = c ? cpChosenHtml(c) : ''; st.drawn = drawn; }   // redrawn only when it changes, so Change keeps focus
    if (hid) hid.value = c ? String(c.clientNo) : '';
    msg.textContent = st.error || (c ? '' : st.hint);
    _cpClass(msg, 'bad', bad);
    _cpAttr(q, 'aria-invalid', bad ? 'true' : 'false');
    _cpAttr(q, 'aria-required', st.required ? 'true' : 'false');
    if (why) {
      why.hidden = !need;
      why.textContent = need ? 'Choose the client first.' : '';
      _cpClass(why, 'bad', need && bad);
    }
    if (submit && why && why.id) _cpAttr(submit, 'aria-describedby', need ? why.id : null);
  }
  function renderList() {
    const all = cpSearch(st.clients, st.q);
    st.hits = all.slice(0, CP_SHOWN); st.more = Math.max(0, all.length - CP_SHOWN);
    if (st.active > st.hits.length) st.active = st.hits.length;          // the Add row is index hits.length
    list.innerHTML = cpListHtml(st, uid);
    _cpAttr(q, 'aria-activedescendant', st.active < 0 ? null : st.active < st.hits.length ? uid + 'o' + st.active : uid + 'oadd');
    const on = st.active >= 0 && list.querySelector('[aria-selected="true"]');
    if (on && on.scrollIntoView) try { on.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older browsers */ }
  }
  function openList(on) {
    st.open = !!on && !st.chosen && !st.hidden;
    list.hidden = !st.open;
    _cpAttr(q, 'aria-expanded', st.open ? 'true' : 'false');
    if (st.open) renderList(); else _cpAttr(q, 'aria-activedescendant', null);
  }
  function search(text) {
    st.q = String(text == null ? '' : text);
    st.touched = true; st.error = '';                 // they are answering it: the red goes until they leave the field
    st.active = st.q.trim() ? 0 : -1;
    openList(true); paint();
  }
  function pick(x, quiet) {
    const c = x && typeof x === 'object' ? x : st.clients.find(k => String(k.clientNo) === String(x));
    if (!c) return false;
    if (!st.clients.some(k => String(k.clientNo) === String(c.clientNo))) st.clients = cpLive(st.clients.concat([c]));
    st.chosen = c; st.error = ''; st.q = ''; q.value = '';
    openList(false); paint();
    if (typeof o.onPick === 'function') { try { o.onPick(c); } catch (e) { /* the page's fill is a convenience */ } }
    if (!quiet) { const b = chosen.querySelector('[data-cp="change"]'); if (b && b.focus) b.focus(); }
    return true;
  }
  function clear(focus) {
    st.chosen = null; st.error = ''; st.q = ''; st.touched = false; q.value = '';
    openList(false); paint();
    if (focus && q.focus) q.focus();
  }
  function check() {
    if (st.hidden || !st.required || st.chosen) return true;
    st.touched = true; st.error = CP_MISSING; paint();
    try { if (root.scrollIntoView) root.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* older browsers */ }
    if (q.focus) q.focus();
    return false;
  }
  function showError(text, require) {
    if (require) st.required = true;
    st.hidden = false; st.touched = true; st.error = String(text || CP_MISSING);
    openList(false); paint();
    try { if (root.scrollIntoView) root.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* older browsers */ }
    const f = st.chosen ? chosen.querySelector('[data-cp="change"]') : q;
    if (f && f.focus) f.focus();
  }
  function setMode(m) {
    m = m || {};
    if (m.hidden !== undefined) st.hidden = !!m.hidden;
    if (m.required !== undefined) st.required = !!m.required;
    if (m.label !== undefined) st.label = m.label || 'Client';
    if (m.hint !== undefined) st.hint = m.hint || '';
    st.error = ''; st.touched = false;
    if (st.hidden) openList(false);
    paint();
  }
  function setClients(list2, lists) {
    st.clients = cpLive(list2);
    if (lists) st.lists = lists;
    if (st.open) renderList();
  }
  /** A name from elsewhere (a Product Finder inquiry): the one client it means is chosen; otherwise it waits in the search. */
  function suggest(name) {
    const c = cpExact(st.clients, name);
    if (c) return pick(c, true);
    st.q = String(name || ''); q.value = st.q;
    return false;
  }
  async function saveNew(f) {
    const res = await cpAddClient(f, { post: o.post, tiers: cpTiers(st.lists), clients: st.clients });
    if (res.fresh) st.clients = res.fresh;
    if (res.ok) {
      st.clients = cpLive(st.clients.concat([res.client]));
      pick(res.client, true);
    }
    return res;
  }

  function onKey(e) {
    const n = st.hits.length;                         // the Add row is index n
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!st.open) openList(true);
      const d = e.key === 'ArrowDown' ? 1 : -1;
      st.active = st.active < 0 ? (d > 0 ? 0 : n) : (st.active + d + n + 1) % (n + 1);
      renderList();
    } else if (e.key === 'Enter') {
      if (!st.open) return;
      e.preventDefault();                             // the search box never submits the form
      if (st.active >= 0 && st.active < n) pick(st.hits[st.active]);
      else if (st.active === n) ctl.openAdd(st.q);
    } else if (e.key === 'Escape' && st.open) {
      e.preventDefault(); e.stopPropagation(); openList(false);
    }
  }
  function onClick(e) {
    const t = e.target, at = (s) => (t && t.closest ? t.closest(s) : null);
    const opt = at('[data-cp-pick]');
    if (opt) { pick(opt.getAttribute('data-cp-pick')); return; }
    if (at('[data-cp-add]') || at('[data-cp="add"]')) { ctl.openAdd(st.q); return; }
    if (at('[data-cp="change"]')) { clear(true); openList(true); }
  }
  if (q.addEventListener) {
    q.addEventListener('input', () => search(q.value));
    q.addEventListener('focus', () => { if (!st.chosen) openList(true); });
    q.addEventListener('keydown', onKey);
  }
  if (list.addEventListener) list.addEventListener('mousedown', (e) => e.preventDefault());   // the search box keeps focus while a row is pressed
  if (root.addEventListener) {
    root.addEventListener('click', onClick);
    root.addEventListener('focusout', () => {
      setTimeout(() => {                              // a tap on a row lands first; then, if focus left the picker, it closes
        const a = document.activeElement;
        if (a && root.contains && root.contains(a)) return;
        openList(false);
        if (st.adding) return;                        // gone to Add a client: not a field left unanswered
        if (st.required && st.touched && !st.chosen && !st.hidden) { st.error = CP_MISSING; paint(); }
      }, 140);
    });
  }

  const ctl = {
    uid, root,
    value: () => (st.chosen ? String(st.chosen.clientNo) : ''),
    client: () => st.chosen,
    clients: () => st.clients.slice(),
    lists: () => st.lists,
    error: () => st.error,
    isRequired: () => !st.hidden && st.required,
    isHidden: () => st.hidden,
    focusTarget: () => (st.chosen ? chosen.querySelector('[data-cp="change"]') : q),
    search, pick, clear, check, showError, setMode, setClients, suggest, saveNew,
    openAdd: (name) => {
      openList(false); st.adding = true;
      const ov = _cpSheet(ctl, o, name == null ? st.q : name, () => { st.adding = false; });
      if (!ov) st.adding = false;
      return ov;
    }
  };
  paint();
  return ctl;
}

/* ── Add a client: a centred sheet on a desk, a bottom sheet on a phone ────────────────────────────────────────── */

function _cpSheet(ctl, o, company, onClose) {
  if (typeof document === 'undefined' || !document.body || !document.createElement) return null;
  const back = document.activeElement, uid = ctl.uid + 's';
  const ov = document.createElement('div');
  ov.className = 'cp-overlay';
  ov.innerHTML = cpSheetHtml({ uid, what: o.what, company: String(company || '').trim(), lists: ctl.lists() });
  document.body.appendChild(ov);
  document.body.classList.add('cp-open');
  const sheet = ov.querySelector('.cp-sheet'), save = ov.querySelector('[data-cp="save"]'), whyEl = ov.querySelector('[data-cp-why]');
  const note = ov.querySelector('[data-cp-note]'), other = ov.querySelector('[data-cp-other]');
  const field = (n) => ov.querySelector('[name="' + n + '"]');
  const read = () => {
    const t = ov.querySelector('input[name="' + uid + 'tier"]:checked');
    return { company: field('company').value, tier: t ? t.value : '', sector: field('sector').value, sectorOther: field('sectorOther').value, siteAddress: field('siteAddress').value };
  };
  let busy = false, dup = null;
  const sync = () => {
    if (other) other.hidden = field('sector').value !== 'Others';
    const v = cpNewPayload(read(), cpTiers(ctl.lists()));
    save.disabled = busy || !!v.error;
    whyEl.textContent = busy ? '' : (v.error || '');
  };
  const toast = (t) => { if (typeof hxToast === 'function') try { hxToast(t, { tone: 'ok' }); } catch (e) { /* the card already says it */ } };
  const close = (picked) => {
    if (!ov.parentNode || ov.dataset.closing) return;
    ov.dataset.closing = '1';
    if (typeof onClose === 'function') onClose();
    ov.classList.remove('in');
    document.body.classList.remove('cp-open');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 280);
    const to = picked || !back || back === document.body ? ctl.focusTarget() : back;   // back where it came from, or the picker
    try { if (to && to.focus) to.focus(); } catch (e) { /* the opener is gone */ }
  };
  const focusables = () => Array.prototype.filter.call(sheet.querySelectorAll('button, input, select, textarea'),
    (x) => !x.disabled && !(x.closest && x.closest('[hidden]')) && (x.type !== 'radio' || x.checked || !ov.querySelector('input[name="' + x.name + '"]:checked')));
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); return; }
    if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type !== 'radio' && !save.disabled) { e.preventDefault(); save.click(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();                           // focus stays in the sheet while it is open
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!sheet.contains(a)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('input', sync);
  ov.addEventListener('change', sync);
  ov.addEventListener('click', async (e) => {
    if (e.target === ov) { close(false); return; }
    const b = e.target.closest ? e.target.closest('[data-cp]') : null;
    if (!b) return;
    const k = b.getAttribute('data-cp');
    if (k === 'cancel') { close(false); return; }
    if (k === 'use' && dup && dup.existing) { ctl.pick(dup.existing, true); close(true); return; }
    if (k !== 'save' || save.disabled) return;
    busy = true; save.textContent = 'Adding…'; note.hidden = true; sync();
    const res = await ctl.saveNew(read());
    busy = false; save.textContent = 'Add client';
    if (res.ok) { toast(res.client.company + ' is in your Client Book now.'); close(true); return; }
    dup = res.duplicate ? res : null;
    note.innerHTML = res.duplicate ? cpDuplicateHtml(res) : '<p>' + _cpE(res.error) + '</p>';
    note.className = 'cp-note' + (res.duplicate ? '' : ' bad');
    note.hidden = false;
    sync();
    const u = note.querySelector('[data-cp="use"]');
    if (u) u.focus();
  });
  _cpDrag(sheet, () => close(false));
  const go = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (f) => setTimeout(f, 16);
  go(() => {
    ov.classList.add('in');
    const c = field('company'), first = c && c.value.trim() ? ov.querySelector('input[type="radio"]') : c;
    if (first && first.focus) first.focus();
    sync();
  });
  return ov;
}

/** Phones: the grabber and the title drag the sheet 1:1 (resisting upward); a release projected past 40 % of its height
 *  closes it, anything less settles it back. The fields scroll as usual. */
function _cpDrag(sheet, dismiss) {
  if (!sheet || !sheet.addEventListener) return;
  const phone = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  let d = null;
  sheet.addEventListener('pointerdown', (e) => {
    if (!phone() || e.button > 0 || !(e.target.closest && e.target.closest('[data-cp-grab], .cp-head'))) return;
    d = { id: e.pointerId, y0: e.clientY, y: 0, hist: [[e.timeStamp, 0]] };
    try { sheet.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    sheet.classList.add('drag');
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    let y = e.clientY - d.y0;
    if (y < 0) { const h = sheet.offsetHeight || 1; y = (y * h * 0.55) / (h + 0.55 * Math.abs(y)); }   // rubber band at the top
    d.y = y; d.hist.push([e.timeStamp, y]); if (d.hist.length > 6) d.hist.shift();
    sheet.style.transform = 'translate3d(0,' + y + 'px,0)';
  });
  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const h = d.hist, a = h[0], b = h[h.length - 1], v = (b[1] - a[1]) / Math.max(1, b[0] - a[0]) * 1000;   // px a second
    const projected = d.y + (v / 1000) * 0.998 / (1 - 0.998), out = projected > (sheet.offsetHeight || 1) * 0.4;
    d = null;
    sheet.classList.remove('drag');
    sheet.style.transform = '';                     // the transition carries it from where the finger left it
    if (out) dismiss();
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cpKey, cpLive, cpSearch, cpExact, cpRequired, cpTiers, cpSectors, cpNewPayload, cpLoadBook, cpAddClient,
    cpOptionHtml, cpListHtml, cpChosenHtml, cpSheetHtml, cpDuplicateHtml, cpMount, CP_MISSING };
}
